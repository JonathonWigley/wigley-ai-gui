import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  drawPart,
  type PartPick,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import { pickLayout } from '../../../../shared/page/layout-host/pick';
import { icon } from '../../../../shared/page/ui/icon';
import { keyChevron } from '../../../../shared/page/ui/key-anchors';
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

export interface DocsPartsDeps {
  layouts(): ShownLayouts<Layout>;
  defaultLayout: CompleteLayout;
  // The base kit for one draw in `scope`, its anchors recorded by `rollback`.
  baseKit(scope: DocsScope, rollback: RollbackDeps): BaseKit;
  log: Log;
}

// One view's part drawer.
export interface DocsParts {
  // Draws `part` into `slot` with the layout the pick chain names, falling
  // back to `default` on a throw; `kit` adds the part's members to the draw's
  // DocsKit, once per attempt. Records the pick it drew with.
  draw<P extends DocsPartName>(
    part: P,
    slot: HTMLElement,
    input: PartInput<P>,
    kit: (docsKit: DocsKit) => PartKit<P>,
  ): DrawnPart;
  // True when a part drawn since the last `markDrawn` would now pick another
  // layout name or another layout object.
  picksChanged(): boolean;
  markDrawn(): void;
}

const PART_SCOPES: Record<DocsPartName, DocsScope> = {
  treePane: 'tree',
  treeLine: 'tree',
  treeRow: 'tree',
  docPane: 'doc',
  emptyDoc: 'doc',
  docHeader: 'doc',
  diskBanner: 'doc',
  docBody: 'doc',
  editorFrame: 'doc',
  conflictPrompt: 'conflict',
  boxDialog: 'box',
  completion: 'box',
  confirmDialog: 'confirm',
  pickerRow: 'picker',
};

const DEFAULT_NAME = 'default';

type PartBuilder<P extends DocsPartName> = (
  parent: HTMLElement,
  input: PartInput<P>,
  kit: PartKit<P>,
) => LayoutPart;

// The layout `part` draws with from `shown`: the user's when it defines the
// part, else `default`.
function pickFor(
  part: DocsPartName,
  shown: ShownLayouts<Layout>,
): PartPick<Layout> {
  const chain =
    shown.user === DEFAULT_NAME ? [DEFAULT_NAME] : [shown.user, DEFAULT_NAME];
  return pickLayout(
    chain,
    shown.layouts,
    (layout) => layout[part] !== undefined,
  );
}

export function createDocsParts(deps: DocsPartsDeps): DocsParts {
  let drawnPicks = new Map<DocsPartName, PartPick<Layout>>();
  return {
    draw(part, slot, input, kit) {
      const pick = pickFor(part, deps.layouts());
      drawnPicks.set(part, pick);
      const scope = PART_SCOPES[part];
      const drawn = drawPart<Layout, PartBuilder<typeof part>, LayoutPart>({
        owner: 'docs',
        parent: slot,
        pick,
        defaultLayout: deps.defaultLayout,
        part: (layout) => layout[part] as PartBuilder<typeof part> | undefined,
        build: (builder, parent, rollback) =>
          builder(
            parent,
            input,
            kit(createDocsKit(deps.baseKit(scope, rollback))),
          ),
        log: deps.log,
        logSource: 'docs',
        partName: part,
      });
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
    picksChanged() {
      const shown = deps.layouts();
      for (const [part, pick] of drawnPicks) {
        const now = pickFor(part, shown);
        if (now.name !== pick.name || now.layout !== pick.layout) {
          return true;
        }
      }
      return false;
    },
    markDrawn() {
      drawnPicks = new Map();
    },
  };
}

// The DocsKit over `base`: its key hints are `base.keyHint`'s, so an edge's
// anchor rolls back and disposes with the draw's other anchors.
export function createDocsKit(base: BaseKit): DocsKit {
  return {
    ...base,
    edge(parent, command, options) {
      const edge = base.el(parent, 'span', 'ui-key-edge');
      if (options.side === 'start') {
        edge.append(keyChevron(options.chevron));
      }
      base.keyHint(edge, command, anchorLabel(options.label));
      if (options.side === 'end') {
        edge.append(keyChevron(options.chevron));
      }
      return edge;
    },
    icon(parent, name, className = '') {
      const node = icon(name);
      if (className !== '') {
        node.classList.add(...className.split(' '));
      }
      parent.append(node);
      return node;
    },
  };
}

// The keyHint options that draw `label` after the keys, or none.
function anchorLabel(label: string | undefined): { label?: string } {
  return label === undefined ? {} : { label };
}

// One app element a kit member places. `place` throws
// `<part>: <member> placed twice` on a second call in one draw;
// `appendIfLeftOut` appends it at the end of `root` when no call placed it,
// and `prependIfLeftOut` at its start.
export interface AppPart {
  place(parent: HTMLElement): HTMLElement;
  appendIfLeftOut(root: HTMLElement): void;
  prependIfLeftOut(root: HTMLElement): void;
}

export function appPart(
  appElement: HTMLElement,
  partName: string,
  member: string,
): AppPart {
  let isPlaced = false;
  return {
    place(parent) {
      if (isPlaced) {
        throw new Error(`${partName}: ${member} placed twice`);
      }
      isPlaced = true;
      parent.append(appElement);
      return appElement;
    },
    appendIfLeftOut(root) {
      if (!isPlaced) {
        root.append(appElement);
      }
    },
    prependIfLeftOut(root) {
      if (!isPlaced) {
        root.prepend(appElement);
      }
    },
  };
}

// Runs `redraw`, then sets back the scroll of each of `scrollers` and the
// focus and selection of the element inside `root` that held focus before,
// which the redraw may have detached and placed again.
export function keepingFocusAndScroll(
  root: HTMLElement,
  scrollers: readonly HTMLElement[],
  redraw: () => void,
): void {
  const tops = scrollers.map((scroller) => scroller.scrollTop);
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && root.contains(active) ? active : null;
  const range = selectionOf(focused);
  redraw();
  scrollers.forEach((scroller, index) => {
    scroller.scrollTop = tops[index];
  });
  const isFocusLost =
    focused !== null &&
    focused !== document.activeElement &&
    root.contains(focused);
  if (isFocusLost) {
    focused.focus({ preventScroll: true });
    if (range !== null) {
      (focused as HTMLInputElement).setSelectionRange(range.start, range.end);
    }
  }
}

// A text input's selection; null for any other element.
function selectionOf(
  focused: HTMLElement | null,
): { start: number; end: number } | null {
  const input = focused as Partial<HTMLInputElement> | null;
  if (input?.selectionStart == null || input.selectionEnd == null) {
    return null;
  }
  return { start: input.selectionStart, end: input.selectionEnd };
}
