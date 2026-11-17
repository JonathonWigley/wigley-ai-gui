import type { PluginLog } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  type AppSlot,
  appSlot,
} from '../../../../shared/page/layout-host/app-slot';
import {
  type PartPick,
  type RollbackDeps,
  requireDialogFrame,
} from '../../../../shared/page/layout-host/draw-part';
import type {
  BaseKit,
  DialogFrameInput,
  DialogFramePart,
} from '../../../../shared/page/layout-host/kit';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import type {
  CompleteLayout,
  DocsKit,
  Layout,
  LayoutPart,
} from '../../layouts/layout';

export type DocsPartName = keyof Layout;
export type PartInput<P extends DocsPartName> = Parameters<
  NonNullable<Layout[P]>
>[1];
export type PartKit<P extends DocsPartName> = Parameters<
  NonNullable<Layout[P]>
>[2];

export interface DrawnPart {
  element: HTMLElement;
  layoutName: string;
  // Removes the element and disposes every anchor the draw named. App parts
  // inside it are detached, not destroyed.
  dispose(): void;
}

// The short names of the scopes a docs part's keys fire in.
export type DocsScope =
  | 'tree'
  | 'doc'
  | 'conflict'
  | 'box'
  | 'confirm'
  | 'picker';

// `layouts` is read when the parts are made and at each `redrawIfChanged`.
export interface DocsPartsDeps {
  layouts(): ShownLayouts<Layout>;
  defaultLayout: CompleteLayout;
  // The base kit for one draw in `scope`, its anchors recorded by `rollback`.
  baseKit(scope: DocsScope, rollback: RollbackDeps): BaseKit;
  log: PluginLog;
}

// The slot of an app element a kit member named `member` places, for one
// drawing attempt; it throws `<part>: <member> placed twice`.
export type SlotFor = (element: HTMLElement, member: string) => AppSlot;

// One view's part drawer.
export interface DocsParts {
  // Draws `part` into `slot` with the layout the pick chain names, falling
  // back to `default` on a throw; `kit` adds the part's members to the draw's
  // DocsKit, once per attempt, making its app slots with `slotFor`. Records
  // the pick it drew with.
  draw<P extends DocsPartName>(
    part: P,
    slot: HTMLElement,
    input: PartInput<P>,
    kit: (docsKit: DocsKit, slotFor: SlotFor) => PartKit<P>,
  ): DrawnPart;
  // Draws a dialog's frame into `slot`, the dialog's scrim, with the layout
  // the pick chain names for `dialogFrame`, in the kit of `scope`; a frame that
  // breaks its contract draws with `default`. Records the pick it drew with.
  // `dispose` removes the panel and disposes the draw.
  dialogFrame(
    slot: HTMLElement,
    input: DialogFrameInput,
    scope: 'box' | 'confirm',
  ): { frame: DialogFramePart; dispose(): void };
  // Reads the layouts shown now and runs `redraw` when a part drawn since the
  // last run would now pick another layout name or another layout object;
  // the picks `redraw` draws are the ones the next call compares.
  redrawIfChanged(redraw: () => void): void;
}

// Places a part's two app elements its layout left out, as its contract
// states: the first at the start of `root`, the last at its end.
export function placeAtEnds([first, last]: AppSlot[], root: HTMLElement): void {
  first.placeIfLeftOut(root, 'start');
  last.placeIfLeftOut(root, 'end');
}

const PART_SCOPES: Record<DocsPartName, DocsScope> = {
  treePane: 'tree',
  treeLine: 'tree',
  treeRow: 'tree',
  treeStatus: 'tree',
  docPane: 'doc',
  emptyDoc: 'doc',
  docHeader: 'doc',
  diskBanner: 'doc',
  docBody: 'doc',
  editorFrame: 'doc',
  conflictPrompt: 'conflict',
  // `dialogFrame` draws with the scope it is given.
  dialogFrame: 'box',
  boxDialog: 'box',
  completion: 'box',
  confirmDialog: 'confirm',
  pickerRow: 'picker',
  pageFrame: 'doc',
  pageAside: 'doc',
  asideHeading: 'doc',
  asideLink: 'doc',
  sectionEditControl: 'doc',
  recentChanges: 'doc',
  listPage: 'doc',
  listRow: 'doc',
  sidebarSwitch: 'tree',
  mainEmpty: 'doc',
};

type PartBuilder<P extends DocsPartName> = (
  parent: HTMLElement,
  input: PartInput<P>,
  kit: PartKit<P>,
) => LayoutPart;

export function createDocsParts(deps: DocsPartsDeps): DocsParts {
  const host = createLayoutParts<Layout, CompleteLayout>({
    owner: 'docs',
    defaultLayout: deps.defaultLayout,
    log: deps.log,
  });
  host.setLayouts(deps.layouts());
  let drawnPicks = new Map<DocsPartName, PartPick<Layout>>();
  return {
    draw(part, slot, input, kit) {
      drawnPicks.set(part, host.pick(part));
      const scope = PART_SCOPES[part];
      const drawn = host.draw(part, slot, (builder, parent, rollback) =>
        // TypeScript cannot relate the generic part's builder to its kit.
        (builder as PartBuilder<typeof part>)(
          parent,
          input,
          kit(deps.baseKit(scope, rollback), (element, member) =>
            appSlot(element, `${part}: ${member}`, rollback),
          ),
        ),
      );
      const drawnElement = drawn.built.element;
      return {
        element: drawnElement,
        layoutName: drawn.layoutName,
        dispose() {
          drawnElement.remove();
          drawn.dispose();
        },
      };
    },
    dialogFrame(slot, input, scope) {
      drawnPicks.set('dialogFrame', host.pick('dialogFrame'));
      const drawn = host.draw(
        'dialogFrame',
        slot,
        (builder, parent, rollback) =>
          requireDialogFrame(
            builder(parent, input, deps.baseKit(scope, rollback)),
            input,
            'dialogFrame',
          ),
      );
      const frame = drawn.built;
      return {
        frame,
        dispose() {
          frame.element.remove();
          drawn.dispose();
        },
      };
    },
    redrawIfChanged(redraw) {
      host.setLayouts(deps.layouts());
      const isChanged = [...drawnPicks].some(([part, pick]) => {
        const now = host.pick(part);
        return now.name !== pick.name || now.layout !== pick.layout;
      });
      if (!isChanged) {
        return;
      }
      drawnPicks = new Map();
      redraw();
    },
  };
}
