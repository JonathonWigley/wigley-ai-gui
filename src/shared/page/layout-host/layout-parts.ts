import {
  DEFAULT_LAYOUT_NAME,
  type LayoutOwner,
} from '../../../contracts/layouts';
import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import {
  type DrawnPart,
  drawPart,
  type PartPick,
  type RollbackDeps,
} from './draw-part';
import { callEach } from '../../call-each';
import { pickLayout } from './pick';

// `defaultLayout` is the owner's built-in layout, defining every part. `owner`
// marks each part root's `data-layout-owner`.
export interface LayoutPartsDeps<C> {
  owner: LayoutOwner;
  defaultLayout: C;
  log: PluginLog;
}

// Draws a part's builder into `parent` and returns the owner's own object,
// whose `element` it appended to `parent`.
export type BuildPart<B, R extends { element: HTMLElement }> = (
  builder: B,
  parent: HTMLElement,
  rollback: RollbackDeps,
) => R;

// An owner's parts over its shown layouts, `L` the layout a user writes and
// `C` the complete one `default` is. It shows `default` alone until the first
// `setLayouts`. A part draws with the user's layout when that layout defines
// the part, else with `default`, through `drawPart`.
export interface LayoutParts<L, C> {
  shown(): ShownLayouts<L>;
  setLayouts(shown: ShownLayouts<L>): void;
  // The layout `key` draws with now.
  pick(key: keyof C & string): PartPick<L>;
  draw<K extends keyof C & string, R extends { element: HTMLElement }>(
    key: K,
    parent: HTMLElement,
    build: BuildPart<C[K], R>,
  ): DrawnPart<R>;
  // `draw`, keeping the draw under `slot` (`key` when left out): the draw kept
  // there before is disposed and its element removed first, so a slot holds
  // one draw's anchors and boxes however often it draws. When that dispose
  // throws, the element is still removed, the slot left empty and the error
  // rethrown with no new draw.
  redraw<K extends keyof C & string, R extends { element: HTMLElement }>(
    key: K,
    parent: HTMLElement,
    build: BuildPart<C[K], R>,
    slot?: string,
  ): DrawnPart<R>;
  // Disposes every draw `redraw` keeps and forgets them, a throw skipping none
  // and the first error rethrown after; their elements stay.
  dispose(): void;
}

export function createLayoutParts<L extends object, C extends L>(
  deps: LayoutPartsDeps<C>,
): LayoutParts<L, C> {
  let shown: ShownLayouts<L> = {
    layouts: new Map<string, L>([[DEFAULT_LAYOUT_NAME, deps.defaultLayout]]),
    user: DEFAULT_LAYOUT_NAME,
  };
  const kept = new Map<string, DrawnPart<{ element: HTMLElement }>>();
  const pick = (key: keyof C & string): PartPick<L> =>
    pickLayout(
      [shown.user, DEFAULT_LAYOUT_NAME],
      shown.layouts,
      (layout) => partOf(layout, key) !== undefined,
    );
  const draw = <K extends keyof C & string, R extends { element: HTMLElement }>(
    key: K,
    parent: HTMLElement,
    build: BuildPart<C[K], R>,
  ): DrawnPart<R> =>
    drawPart<L, C[K], R>({
      owner: deps.owner,
      parent,
      pick: pick(key),
      defaultLayout: deps.defaultLayout,
      // TypeScript cannot relate a user layout's optional part to the
      // complete one's.
      part: (layout) => partOf(layout, key) as C[K] | undefined,
      build,
      log: deps.log,
      partName: key,
    });
  return {
    shown: () => shown,
    setLayouts(next) {
      shown = next;
    },
    pick,
    draw,
    redraw(key, parent, build, slot = key) {
      const last = kept.get(slot);
      kept.delete(slot);
      try {
        last?.dispose();
      } finally {
        last?.built.element.remove();
      }
      const next = draw(key, parent, build);
      kept.set(slot, next);
      return next;
    },
    dispose() {
      const draws = [...kept.values()];
      kept.clear();
      callEach(draws, (drawn) => drawn.dispose());
    },
  };
}

function partOf(layout: object, key: string): unknown {
  return (layout as Record<string, unknown>)[key];
}
