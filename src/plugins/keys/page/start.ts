import './keys.css';
import { coreScopeSlot } from '../../../contracts/core-state';
import type { PageApi, PagePart, PushedScope } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import { PLACEMENT_CHECK_EVENT } from '../../../shared/placement-check';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageEvents } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { keysManifest } from '../manifest';
import { helpSections } from './help-sections';
import { mountHelpView } from './help-view';
import { createKeysParts, type Drawn } from './layout/keys-parts';
import { readKeysLayout } from './layout/read-keys-layout';
import { startUnplacedLog } from './unplaced-log';
import { whichKeyModel } from './which-key';
import { startWhichKey } from './which-key-controller';
import { mountWhichKeyView } from './which-key-view';

// The keys plugin's main part only registers its layouts, so its channel
// carries nothing.
type KeysApi = PageApi<
  typeof keysManifest,
  { invoke: Record<never, never>; messages: Record<never, never> },
  KeysPageEvents
>;

// Shows which-key over every pending key sequence, on the page and in a box;
// the help overlay over the `help` scope while it is open, closing when the
// scope under it changes; and the Keys button at the title bar's end, its key
// prompt inside it, which opens help. Each draws through the `keys.layout`
// layout: help and the Keys button draw again on a new set, which-key at its
// next show. Each reads the keymap and settings as they are now, and help
// redraws when the keymap changes. The core holds the anchors: this part tells
// it the `showHints` setting. Records each scope in force and checks it against
// the core's placed anchors for unplaced binds on `PLACEMENT_CHECK_EVENT`, whose
// `document` listener `dispose` removes.
export const keysPagePart: PagePart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const { keys, services } = api;
    const platform = api.platform.os;
    let hintsShown = keys.setHintsShown(api.settings().showHints);
    const parts = createKeysParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys,
        state: api.state.forLayouts,
        commands: {
          exists: (id) => keys.command(id) !== undefined,
          argShape: (id) => keys.command(id)?.arg,
          run: (id) => api.commands.run(id),
        },
        platform,
      },
      log: services.log,
    });
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
      view: mountWhichKeyView(api.areas.overlay, parts),
      timers: services.timers,
      delayMs: () => api.settings().whichKeyDelayMs,
      timeoutMs: () => api.settings().whichKeyTimeoutMs,
      log: services.log,
    });

    const currentHelpSections = () =>
      helpSections(keys.keymap(), keys.scopes, keys.label, platform);
    const closeHelpCommand = qualify(keysManifest.id, 'closeHelp');
    const closeHint = element('span', 'keys-close-hint');
    keys.anchor(closeHint, closeHelpCommand, {
      scope: qualify(keysManifest.id, 'help'),
    });
    const help = mountHelpView(
      api.areas.overlay,
      currentHelpSections(),
      () => api.commands.run(closeHelpCommand),
      closeHint,
      parts,
    );
    // The pushed `help` scope while help is open, `null` while it is closed.
    let helpScope: PushedScope | null = null;
    // What held focus as help opened, given it back as the user closes help.
    let focusedBeforeHelp: Element | null = null;
    const hideHelp = () => {
      helpScope?.pop();
      helpScope = null;
      help.hide();
    };
    const closeHelp = () => {
      hideHelp();
      const focused = focusedBeforeHelp;
      focusedBeforeHelp = null;
      if (focused instanceof HTMLElement && focused.isConnected) {
        focused.focus();
      }
    };

    const keysButtonSlot = element('span', 'keys-title-bar-slot');
    api.areas.titleBar.contribute(keysButtonSlot, { align: 'end' });
    let keysButton: Drawn = parts.titleBarButton(keysButtonSlot);
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readKeysLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        const lastKeysButton = keysButton;
        callEach<() => void>(
          [
            () => lastKeysButton.dispose(),
            () => {
              keysButton = parts.titleBarButton(keysButtonSlot);
            },
            () => help.layoutsChanged(),
          ],
          (step) => step(),
        );
      },
    });

    keys.onKeymapChanged(() => {
      help.setSections(currentHelpSections());
    });
    api.onSettingsChanged((settings) => {
      const lastHintsShown = hintsShown;
      hintsShown = keys.setHintsShown(settings.showHints);
      lastHintsShown.dispose();
    });
    const scopeSlot = api.state.read(coreScopeSlot);
    const unplacedLog = startUnplacedLog({
      keymap: () => keys.keymap(),
      scope: () => keys.scope(),
      placedIn: keys.placedIn,
      onScopeChanged: (listener) =>
        scopeSlot.on((scope) => {
          if (scope !== undefined) {
            listener(scope);
          }
        }),
      log: services.log,
    });
    const checkPlacement = () => unplacedLog.checkSeen();
    document.addEventListener(PLACEMENT_CHECK_EVENT, checkPlacement);

    return {
      dispose() {
        document.removeEventListener(PLACEMENT_CHECK_EVENT, checkPlacement);
      },
      commands: {
        toggleHelp(context) {
          if (helpScope !== null) {
            closeHelp();
            return;
          }
          focusedBeforeHelp = document.activeElement;
          helpScope = keys.pushScope('help');
          // A view that changes under help, such as a prompt opening, shows at
          // once rather than behind help's scrim, and keeps the focus it took.
          helpScope.onBaseChanged(() => {
            focusedBeforeHelp = null;
            hideHelp();
          });
          context.editor?.blur();
          help.show();
          api.events.emit('helpOpened', null);
        },
        closeHelp,
      },
    };
  },
};
