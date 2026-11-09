import type { ViewScope } from '../../../../contracts/keymap';
import type { PluginLog } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import type { OwnerKitServices } from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import { qualify } from '../../../../shared/plugin-manifests';
import type {
  CompleteLayout,
  HelpInput,
  Layout,
  LeaderSearchRowInput,
  WhichKeyInput,
} from '../../layouts/layout';
import { keysManifest } from '../../manifest';
import { createKeysKit } from './keys-kit';

// A drawn part. `dispose` removes the element and disposes every anchor the
// part and the parts nested in it named.
export interface Drawn {
  element: HTMLElement;
  dispose(): void;
}

export interface KeysPartsDeps {
  defaultLayout: CompleteLayout;
  kit: OwnerKitServices;
  log: PluginLog;
}

// Draws each keys surface's part into `parent` with the layouts last set,
// `default` alone until the first `setLayouts`. Each part, nested ones
// included, picks its own layout and falls back to `default` on a throw.
// `setLayouts` only stores the set; the views draw again.
export interface KeysParts {
  help(parent: HTMLElement, input: HelpInput): Drawn;
  whichKey(parent: HTMLElement, input: WhichKeyInput): Drawn;
  leaderSearchRow(parent: HTMLElement, input: LeaderSearchRowInput): Drawn;
  titleBarButton(parent: HTMLElement): Drawn;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

type PartName = keyof CompleteLayout;

const HELP_SCOPE = qualify(keysManifest.id, 'help');
const PICKER_SCOPE = qualify(keysManifest.id, 'picker');

// The scope each part's keys fire in; null anchors with no scope, so the
// Keys button's hint shows in every scope.
const PART_SCOPES: Record<PartName, ViewScope | null> = {
  help: HELP_SCOPE,
  helpSection: HELP_SCOPE,
  helpRow: HELP_SCOPE,
  whichKey: 'any',
  whichKeyEntry: 'any',
  leaderSearchRow: PICKER_SCOPE,
  titleBarButton: null,
};

export function createKeysParts(deps: KeysPartsDeps): KeysParts {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: keysManifest.id,
    defaultLayout: deps.defaultLayout,
    log: deps.log,
  });

  // Draws `part` into `parent` with its own pick; `call` runs the builder
  // with a kit whose anchors `rollback` records.
  const draw = <P extends PartName>(
    part: P,
    parent: HTMLElement,
    call: (
      builder: CompleteLayout[P],
      slot: HTMLElement,
      rollback: RollbackDeps,
    ) => HTMLElement,
  ): Drawn => {
    const drawn = layoutParts.draw(part, parent, (builder, slot, rollback) => ({
      element: call(builder, slot, rollback),
    }));
    const element = drawn.built.element;
    return {
      element,
      dispose() {
        element.remove();
        drawn.dispose();
      },
    };
  };

  const kitFor = (part: PartName, rollback: RollbackDeps) =>
    createKeysKit(deps.kit, PART_SCOPES[part], rollback);

  // Draws a part nested in another part's draw: its dispose joins the outer
  // draw's, so a rollback or a dispose of the outer part reaches it.
  const nested = <P extends PartName>(
    part: P,
    parent: HTMLElement,
    outer: RollbackDeps,
    call: (
      builder: CompleteLayout[P],
      slot: HTMLElement,
      rollback: RollbackDeps,
    ) => HTMLElement,
  ): HTMLElement => {
    const drawn = draw(part, parent, call);
    outer.recordAnchor(drawn);
    return drawn.element;
  };

  return {
    help(parent, input) {
      return draw('help', parent, (help, slot, helpRollback) =>
        help(slot, input, {
          ...kitFor('help', helpRollback),
          helpSection: (sectionParent, section) =>
            nested(
              'helpSection',
              sectionParent,
              helpRollback,
              (helpSection, sectionSlot, sectionRollback) =>
                helpSection(sectionSlot, section, {
                  ...kitFor('helpSection', sectionRollback),
                  hint: (rowParent, hint) =>
                    nested(
                      'helpRow',
                      rowParent,
                      sectionRollback,
                      (helpRow, rowSlot, rowRollback) =>
                        helpRow(rowSlot, hint, kitFor('helpRow', rowRollback)),
                    ),
                }),
            ),
        }),
      );
    },
    whichKey(parent, input) {
      return draw('whichKey', parent, (whichKey, slot, rollback) =>
        whichKey(slot, input, {
          ...kitFor('whichKey', rollback),
          entry: (entryParent, entry) =>
            nested(
              'whichKeyEntry',
              entryParent,
              rollback,
              (whichKeyEntry, entrySlot, entryRollback) =>
                whichKeyEntry(
                  entrySlot,
                  entry,
                  kitFor('whichKeyEntry', entryRollback),
                ),
            ),
        }),
      );
    },
    leaderSearchRow(parent, input) {
      return draw(
        'leaderSearchRow',
        parent,
        (leaderSearchRow, slot, rollback) =>
          leaderSearchRow(slot, input, kitFor('leaderSearchRow', rollback)),
      );
    },
    titleBarButton(parent) {
      return draw('titleBarButton', parent, (titleBarButton, slot, rollback) =>
        titleBarButton(slot, kitFor('titleBarButton', rollback)),
      );
    },
    setLayouts: layoutParts.setLayouts,
  };
}
