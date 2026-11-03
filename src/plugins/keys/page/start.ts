import './keys.css';
import type { PageApi, PagePart, PushedScope } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import { PLACEMENT_CHECK_EVENT } from '../../../shared/placement-check';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { keysManifest } from '../manifest';
import { createAnchors } from './anchors';
import { helpSections } from './help-sections';
import { mountHelpView } from './help-view';
import { keysFor, promptKeysFor } from './keys-for';
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
  { invoke: Record<never, never>; messages: Record<never, never> }
>;

// Shows which-key over every pending key sequence, on the page and in a box;
// the help overlay over the `help` scope while it is open, closing when the
// scope under it changes; and the Keys button at the title bar's end, its key
// prompt inside it, which opens help. Each draws through the `keys.layout`
// layout: help and the Keys button draw again on a new set, which-key at its
// next show. Each reads the keymap and settings as they are now, and help and
// every anchor redraw when the keymap changes.
// Exports the keys bound to a command, and when they change, and `anchor`,
// which draws a command's keys into a view's element, shown while its scope is
// in force and the `showHints` setting is on. Records each scope in force and every anchor
// named, and checks them for unplaced binds on `PLACEMENT_CHECK_EVENT`.
export const keysPagePart: PagePart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const { keys, services, platform } = api;
    const anchors = createAnchors({
      keysFor: (command, scope, where) =>
        promptKeysFor(keys.keymap(), command, scope, platform, where),
      label: keys.label,
      scope: () => keys.scope(),
      showHints: () => api.settings().showHints,
      platform,
    });
    const parts = createKeysParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys: {
          anchor: anchors.anchor,
          keysFor: (command, scope) =>
            keysFor(keys.keymap(), command, scope, platform),
        },
        commands: {
          exists: (id) => keys.command(id) !== undefined,
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
    anchors.anchor(closeHint, closeHelpCommand, {
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
      defaultStylesheet: null,
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
      anchors.redraw();
    });
    keys.onScopeChanged(() => anchors.applyVisibility());
    api.onSettingsChanged(() => anchors.applyVisibility());
    const unplacedLog = startUnplacedLog({
      keymap: () => keys.keymap(),
      scope: () => keys.scope(),
      placedIn: anchors.placedIn,
      onScopeChanged: (listener) => keys.onScopeChanged(listener),
      log: services.log,
    });
    document.addEventListener(PLACEMENT_CHECK_EVENT, () =>
      unplacedLog.checkSeen(),
    );

    const exports: KeysPageExports = {
      keysFor: (command, scope, where) =>
        keysFor(keys.keymap(), command, scope, platform, where),
      onChanged: (listener) => keys.onKeymapChanged(() => listener()),
      anchor: anchors.anchor,
    };
    return {
      exports,
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
        },
        closeHelp,
      },
    };
  },
};
